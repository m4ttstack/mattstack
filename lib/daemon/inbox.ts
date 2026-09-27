import { SYSTEM_HANDLE } from "./handlers/herd.ts";

// 1000ms once let one slow-but-alive recipient (heavy load, not actually
// gone) register as a dropped push -- the failure that started the silent
// deadlock this file's delivery fix addresses. 3000ms gives a busy inbox
// room to answer before the caller gives up on it.
export const DEFAULT_TIMEOUT_MS = 3000;

// A liveness probe, not a delivery attempt: 250ms is enough for a local
// unix socket accept and short enough that `rt herd status` stays snappy
// when the shepherd's own session is gone.
export const DEFAULT_PROBE_TIMEOUT_MS = 250;

/** Whether a socket at `socketPath` will accept a connection right now, without writing anything to it. */
export async function probeInboxReachability(
  socketPath: string,
  opts?: { timeoutMs?: number },
): Promise<"reachable" | "unreachable"> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  // Shared across both racers so a late connect (after the timeout already
  // resolved "unreachable") closes without ever resolving again.
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = new Promise<"reachable" | "unreachable">((resolve) => {
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          if (settled) { socket.end(); return; }
          settled = true;
          clearTimeout(timer);
          socket.end();
          resolve("reachable");
        },
        data() {},
        error() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve("unreachable");
        },
      },
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("unreachable");
    });
  });

  const timeout = new Promise<"unreachable">((resolve) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("unreachable");
    }, timeoutMs);
  });

  return Promise.race([attempt, timeout]);
}

export async function deliverToInbox(
  socketPath: string,
  content: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const frame = {
    msgV: 1,
    msg_id: crypto.randomUUID(),
    type: "user",
    message: { role: "user", content },
    priority: "next",
  };
  const line = JSON.stringify(frame) + "\n";

  // Shared across both racers so a late connect (after the timeout already
  // told the caller ok:false) closes without writing, instead of delivering
  // a frame the caller believes never went out.
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          if (settled) {
            socket.end();
            return;
          }
          settled = true;
          clearTimeout(timer);
          socket.write(line);
          socket.end();
          resolve({ ok: true });
        },
        data() {},
        error(_socket, error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, error: error.message });
        },
      },
    }).catch((error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  });

  const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
  });

  return Promise.race([attempt, timeout]);
}

export interface DeliveryItem { room: string; dm: boolean; handle: string; name: string; body: string; id: number }

/**
 * The `#<id>` is what `rt chat ack <messageId>` takes. It rides next to the
 * sender rather than at the end of the line because a batch collapses to one
 * truncated row in the terminal: an id at the end of a long body would be cut
 * off exactly when a bundle makes it necessary to tell the messages apart.
 */
export function renderDeliveries(items: DeliveryItem[]): string {
  return items
    .map((item) => `${item.dm ? "[dm]" : `[#${item.room}]`} ${item.name} #${item.id}: ${item.body}`)
    .join("\n");
}

/** Distinct repliable senders: the herd's system poster has no reader, so a dm to it is never offered. */
function distinctSenders(senders: Array<{ handle: string; name: string }>): Array<{ handle: string; name: string }> {
  return [...new Map(senders.filter((s) => s.handle !== SYSTEM_HANDLE).map((s) => [s.handle, s])).values()];
}

/** One reply line per distinct sender: the lines above show names, and a name can change hands before the reply is sent. */
export function senderHints(senders: Array<{ handle: string; name: string }>): string[] {
  return distinctSenders(senders).map((s) => `  reply to ${s.name}: rt chat dm ${s.handle} "..."`);
}

/**
 * Claude Code's terminal renders an inbound peer message collapsed (one
 * labeled row, body hidden until expanded) ONLY when the content opens with
 * its `<cross-session-message ...>` envelope; bare text renders in full.
 * `from-name` is the collapsed row's label. No `from` attribute: that is a
 * SendMessage reply address, and rt recipients reply via `rt chat post/dm`
 * (taught in the body), so advertising an unreachable address would misteach
 * the reply path. The envelope changes presentation only -- the model always
 * receives the full body.
 */
export function wrapCrossSession(label: string, body: string): string {
  const safe = label.replace(/["<>]/g, "'");
  return `<cross-session-message from-name="${safe}">\n${body}\n</cross-session-message>`;
}

/**
 * Appended inside every wrapped message delivery. The host frames envelope
 * content as "Another Claude session sent a message" and steers replies
 * toward its own session-messaging tool, so the actual reply channel must
 * be restated at the moment the reflex fires, once per delivery. It is the
 * only agent-facing text that shows an id: a reply must reach the exact
 * sender even after its display name has passed to someone else.
 */
export function replySteer(senders: Array<{ handle: string; name: string }>): string {
  const distinct = distinctSenders(senders);
  const tail = "(never SendMessage; this arrived through rt chat)";
  if (distinct.length === 1) return `reply via rt chat post <room> "..." or rt chat dm ${distinct[0]!.handle} "..." ${tail}`;
  return [`reply via rt chat post <room> "..." or rt chat dm <id> "..." ${tail}`, ...senderHints(distinct)].join("\n");
}

/** The collapsed row's label: the sender for a single message, a count for a batched catch-up. */
export function deliveryLabel(items: Array<Pick<DeliveryItem, "room" | "dm" | "name">>): string {
  if (items.length === 1) {
    const item = items[0]!;
    return `${item.name} (${item.dm ? "dm" : `#${item.room}`})`;
  }
  return `rt chat (${items.length} messages)`;
}
