/**
 * The contract between console's embeddable settings page
 * (`/embed/settings/<group>`) and any app that frames it. Framework-neutral:
 * console posts with `embedMessage`, a host reads with `readEmbedMessage`.
 */

export const EMBED_SOURCE = "mattstack-settings-embed";

/** `height`: the content's scroll height, for sizing the frame. `saved`: a
    write landed; re-read anything that depends on it. `close`: Escape
    inside the frame. */
export type EmbedMessage =
  | { source: typeof EMBED_SOURCE; type: "height"; height: number }
  | { source: typeof EMBED_SOURCE; type: "saved"; key: string; group: string }
  | { source: typeof EMBED_SOURCE; type: "close" };

type Body<T extends EmbedMessage["type"]> = Omit<Extract<EmbedMessage, { type: T }>, "source" | "type">;

export function embedMessage<T extends EmbedMessage["type"]>(
  type: T,
  ...body: keyof Body<T> extends never ? [] : [Body<T>]
): EmbedMessage {
  return { source: EMBED_SOURCE, type, ...body[0] } as EmbedMessage;
}

export function readEmbedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.source !== EMBED_SOURCE) return null;
  if (m.type === "height" && typeof m.height === "number" && Number.isFinite(m.height))
    return { source: EMBED_SOURCE, type: "height", height: m.height };
  if (m.type === "saved" && typeof m.key === "string" && typeof m.group === "string")
    return { source: EMBED_SOURCE, type: "saved", key: m.key, group: m.group };
  if (m.type === "close") return { source: EMBED_SOURCE, type: "close" };
  return null;
}

/** Console's origin beside the host page's own: `board.mattstack` →
    `console.mattstack`, `chat.localhost` → `console.localhost`. A bare
    `localhost:<port>` page (a dev or fixture server) gets deck's local name
    for console, which redirects to its canonical host; any other host gets
    the canonical name outright. */
export function consoleOrigin(loc: { protocol: string; hostname: string }): string {
  const host = loc.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "https://console.localhost";
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (labels.length >= 2 && (tld === "mattstack" || tld === "localhost"))
    return `${loc.protocol}//${["console", ...labels.slice(1)].join(".")}`;
  return "https://console.mattstack";
}

export interface EmbedSrcOptions {
  origin: string;
  /** A console settings group id (`board`, `chat`, `deck`, `boxscore`, ...). */
  group: string;
  scheme: "light" | "dark";
  /** A key to open on arrival. */
  focusKey?: string;
}

export function embedSrc({ origin, group, scheme, focusKey }: EmbedSrcOptions): string {
  const url = new URL(`/embed/settings/${encodeURIComponent(group)}`, origin);
  url.searchParams.set("scheme", scheme);
  if (focusKey) url.searchParams.set("explain", focusKey);
  return url.toString();
}
