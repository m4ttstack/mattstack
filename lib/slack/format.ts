export const SLACK_PREFIX = "[Claude 🤖]: ";

/** conversations.history can return the emoji as its shortcode. */
const SHORTCODE_PREFIX = "[Claude :robot_face:]: ";

function prefixLength(text: string): number {
  if (text.startsWith(SLACK_PREFIX)) return SLACK_PREFIX.length;
  if (text.startsWith(SHORTCODE_PREFIX)) return SHORTCODE_PREFIX.length;
  return 0;
}

export function hasPrefix(text: string): boolean {
  return prefixLength(text) > 0;
}

export function withPrefix(body: string): string {
  let rest = body.trimStart();
  for (let n = prefixLength(rest); n > 0; n = prefixLength(rest)) rest = rest.slice(n).trimStart();
  return SLACK_PREFIX + rest;
}

export function holdingLine(operatorName: string): string {
  return `${SLACK_PREFIX}Claude is tied up for a moment. Your message is safe, and ${operatorName} has been told.`;
}

export function closingLine(operatorName: string, paneGone: boolean): string {
  const base = `${SLACK_PREFIX}This chat with Claude is closed. Anything you send now goes to ${operatorName}.`;
  return paneGone ? `${base} ${operatorName} will follow up.` : base;
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
