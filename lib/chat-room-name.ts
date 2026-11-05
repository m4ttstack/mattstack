/**
 * Turns a display label (a repo alias, a pane title, a cwd-derived string)
 * into a valid chat name: `rt chat`'s charset (`[a-z0-9._-]+`) is stricter
 * than any of those sources, so both the CLI's git-derived room/handle
 * fallbacks (commands/chat.ts) and the daemon's index-derived room
 * (lib/daemon/handlers/chat.ts, `--pane` sign-in) route through this one
 * function, so the same repo label always slugifies to the same room name
 * regardless of which side derived it.
 *
 * Null when `raw` holds nothing usable. No placeholder takes its place: every
 * caller that shared one would become the same chat identity or room.
 */
export function slugifyChatName(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug || null;
}
