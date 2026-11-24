/** The support queue's wire. The relay image copies only
 *  `apps/board/switchboard/*.ts`, so `switchboard/support.ts` redeclares the
 *  draft and its limits; its tests hold the two together. */

export type SupportKind = "request" | "status";

export interface SupportDraft {
  id: string;
  to: string;
  kind: SupportKind;
  sentAt: number;
  body: string;
  mac: string;
}

export interface SupportMessage extends SupportDraft {
  from: string;
  receivedAt: number;
}

export interface SupportHostState {
  accepting: boolean;
  lastSeenAt: number | null;
}

export type SupportDirection = "in" | "out";
export type SupportState =
  | "sent"
  | "received"
  | "opening"
  | "opened"
  | "waiting"
  | "already-waiting"
  | "already-open"
  | "declined"
  | "not-accepting"
  | "failed"
  | "expired";

export interface SupportPart {
  key: "versions" | "setup" | "mr";
  label: string;
  value: string;
}

/** `in` is a request this Mac answers, `out` one it sent; `peer` is the other person's forge username. */
export interface SupportRequest {
  id: string;
  direction: SupportDirection;
  peer: string;
  /** The path of the org clone's remote, which a rename of its folder keeps. */
  org: string;
  text: string;
  parts: SupportPart[];
  slackUserId: string;
  state: SupportState;
  reason: string | null;
  /** The host's bot, as its Mac named it; null until a status says. */
  persona: string | null;
  dmLink: string | null;
  conversationId: number | null;
  gateId: string | null;
  /** The time on the last status sent about it (in) or believed (out), so an older one never overwrites a newer. */
  statusAt: number;
  sentAt: number;
  receivedAt: number;
  updatedAt: number;
}

export const SUPPORT_BODY_MAX_BYTES = 64 * 1024;
/** The body is JSON inside the request's JSON, so every quote in it can double. */
export const SUPPORT_REQUEST_MAX_BYTES = 2 * SUPPORT_BODY_MAX_BYTES + 4 * 1024;
export const SUPPORT_TTL_MS = 7 * 24 * 60 * 60_000;
export const SUPPORT_TEXT_MAX = 8000;
export const SUPPORT_PART_MAX = 2000;
export const SUPPORT_PARTS_MAX = 12;
export const SUPPORT_AWAY_MS = 2 * 60_000;

/** SQLite turns a lone surrogate into other characters, so an id holding one could be stored and never acked. */
const ID = /^[A-Za-z0-9._:-]{1,200}$/;
/** A status is `<request id>:<state>`, so a request id leaves room for it. */
const REQUEST_ID_MAX = 128;
const MAC = /^[A-Za-z0-9._:-]{1,256}$/;

function canonical(username: string): string {
  return username.trim().toLowerCase();
}

/** The character limits above do not bound the bytes: text in a wide script can pass them and still be too large to send. */
export function supportBodyTooLarge(body: string): boolean {
  return new TextEncoder().encode(body).length > SUPPORT_BODY_MAX_BYTES;
}

export function parseSupportDraft(v: unknown): SupportDraft | null {
  if (!v || typeof v !== "object") return null;
  const { id, to, kind, sentAt, body, mac } = v as Record<string, unknown>;
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (typeof to !== "string" || !to.trim() || to.trim() === "*") return null;
  if (kind !== "request" && kind !== "status") return null;
  if (kind === "request" && id.length > REQUEST_ID_MAX) return null;
  if (typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  if (typeof body !== "string" || supportBodyTooLarge(body)) return null;
  if (typeof mac !== "string" || !MAC.test(mac)) return null;
  return { id, to: canonical(to), kind, sentAt, body, mac };
}

export function parseSupportMessage(v: unknown): SupportMessage | null {
  const draft = parseSupportDraft(v);
  if (!draft) return null;
  const { from, receivedAt } = v as Record<string, unknown>;
  if (typeof from !== "string" || !from.trim()) return null;
  if (typeof receivedAt !== "number" || !Number.isFinite(receivedAt)) return null;
  return { ...draft, from: canonical(from), receivedAt };
}
